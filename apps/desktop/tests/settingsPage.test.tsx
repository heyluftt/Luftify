import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "../src/pages/SettingsPage";
import { desktopApi } from "../src/services/desktopApi";
import type { Settings } from "../src/types/tauri";
import { DEFAULT_AUDIO_CONTROL_SETTINGS } from "../src/features/audio-control/audioControl";
import { DEFAULT_LYRICS_VISUAL_SETTINGS } from "../src/features/lyrics/lyricsVisualSettings";

const settings = (): Settings => ({
  theme: "dark", reconnectResumeMode: "ifWasPlaying",
  closeBehavior: "minimizeToTray", windowsAutostart: false, startInTrayOnAutostart: false,
  lastRoute: "/", searchHistoryEnabled: true,
  nowPlayingListNavigationEnabled: true,
  listeningAnalyticsEnabled: true,
  homeFeatureMode: "lastPlayed", homeFeaturePlaylistUri: null, lyricsEnabled: true,
  songVideosEnabled: false, experimentalLibreCanvas: false,
  lyricsVisuals: DEFAULT_LYRICS_VISUAL_SETTINGS,
  audioControl: DEFAULT_AUDIO_CONTROL_SETTINGS,
  miniplayer: { scale: 1, opacityPercent: 94, alwaysOnTop: true, clickThrough: false, positionX: null, positionY: null },
});

function renderSettings() {
  vi.spyOn(desktopApi, "librespotStatus").mockResolvedValue({
    phase: "needsLogin",
    credentialsPresent: false,
    username: null,
    message: "Melde dich einmal mit einem Premium-Konto an.",
  });
  vi.spyOn(desktopApi, "audioOutputs").mockResolvedValue([
    { name: "Lautsprecher (Realtek)", isDefault: true },
    { name: "Voicemeeter Input", isDefault: false },
  ]);
  vi.spyOn(desktopApi, "cacheUsage").mockResolvedValue({
    lyrics: { bytes: 0, entries: 0 },
    playlists: { bytes: 0, entries: 0 },
    covers: { bytes: 0, entries: 0 },
    total: { bytes: 0, entries: 0 },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><SettingsPage /></QueryClientProvider>);
}

describe("Settings page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("previews and saves the Luft Violet theme", async () => {
    vi.spyOn(desktopApi, "settings").mockResolvedValue(settings());
    const save = vi.spyOn(desktopApi, "saveSettings").mockResolvedValue();
    renderSettings();

    fireEvent.click(await screen.findByRole("button", { name: /Luft Violet/ }));
    // The theme switches as soon as its stylesheet is loaded.
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("luft.violet"));

    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      theme: "luft",
    }));
  });

  it("previews and saves the Redline theme", async () => {
    vi.spyOn(desktopApi, "settings").mockResolvedValue(settings());
    const save = vi.spyOn(desktopApi, "saveSettings").mockResolvedValue();
    renderSettings();

    fireEvent.click(await screen.findByRole("button", { name: /Redline/ }));
    // The theme switches as soon as its stylesheet is loaded.
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("luft.redline"));

    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      theme: "redline",
    }));
  });

  it("previews and saves the Tiefsee theme", async () => {
    vi.spyOn(desktopApi, "settings").mockResolvedValue(settings());
    const save = vi.spyOn(desktopApi, "saveSettings").mockResolvedValue();
    renderSettings();

    fireEvent.click(await screen.findByRole("button", { name: /Tiefsee/ }));
    // The theme switches as soon as its stylesheet is loaded.
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("luft.abyss"));

    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      theme: "abyss",
    }));
  });

  it("previews and saves the Rosé Nocturne theme", async () => {
    vi.spyOn(desktopApi, "settings").mockResolvedValue(settings());
    const save = vi.spyOn(desktopApi, "saveSettings").mockResolvedValue();
    renderSettings();

    fireEvent.click(await screen.findByRole("button", { name: /Rosé Nocturne/ }));
    // The theme switches as soon as its stylesheet is loaded.
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("luft.rose"));

    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      theme: "rose",
    }));
  });

  it("does not offer the removed illustrated themes", async () => {
    vi.spyOn(desktopApi, "settings").mockResolvedValue(settings());
    renderSettings();

    expect(await screen.findByRole("button", { name: /Luft Violet/ })).toBeVisible();
    expect(screen.getByText("Suchen oder Befehl ausführen")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Neon Sakura/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Rouge Hour/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Whiteout Zero/ })).not.toBeInTheDocument();
  });

  it("saves a local most-played home recommendation mode", async () => {
    vi.spyOn(desktopApi, "settings").mockResolvedValue(settings());
    const save = vi.spyOn(desktopApi, "saveSettings").mockResolvedValue();
    renderSettings();

    fireEvent.click(await screen.findByRole("combobox", { name: "Auswahl" }));
    fireEvent.click(await screen.findByRole("option", { name: "Am häufigsten gehört" }));

    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ homeFeatureMode: "mostPlayed" }));
  });

  it("resets only the local playlist usage statistics", async () => {
    vi.spyOn(desktopApi, "settings").mockResolvedValue(settings());
    const reset = vi.spyOn(desktopApi, "resetPlaylistUsage").mockResolvedValue();
    renderSettings();

    fireEvent.click(await screen.findByRole("button", { name: "Startseiten-Zähler löschen" }));

    await waitFor(() => expect(reset).toHaveBeenCalledOnce());
  });

  it("saves calm waves without replacing the existing pulse option", async () => {
    vi.spyOn(desktopApi, "settings").mockResolvedValue(settings());
    const save = vi.spyOn(desktopApi, "saveSettings").mockResolvedValue();
    renderSettings();

    fireEvent.click(await screen.findByRole("checkbox", {
      name: /Ambient-Bewegung/,
    }));
    fireEvent.click(screen.getByRole("radio", { name: /Ruhige Wellen/ }));
    fireEvent.change(screen.getByRole("slider", { name: "Farbstärke" }), {
      target: { value: "200" },
    });
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0]?.[0].lyricsVisuals).toEqual(expect.objectContaining({
      enabled: true,
      mode: "waves",
      colorStrengthPercent: 200,
    }));
    expect(screen.getByRole("radio", { name: /Kräftiger Puls/ })).toBeVisible();
  });

  it("saves the optional audio visualizer independently of the ambient style", async () => {
    vi.spyOn(desktopApi, "settings").mockResolvedValue(settings());
    const save = vi.spyOn(desktopApi, "saveSettings").mockResolvedValue();
    renderSettings();

    const visualizer = await screen.findByRole("checkbox", { name: /Audio-Visualizer/ });
    expect(visualizer).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: /Ambient-Bewegung/ }));
    expect(visualizer).toBeEnabled();
    const recognition = screen.getByRole("slider", { name: "Erkennung" });
    expect(recognition).toBeDisabled();
    fireEvent.click(visualizer);
    expect(recognition).toBeEnabled();
    fireEvent.change(recognition, { target: { value: "90" } });
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0]?.[0].lyricsVisuals).toEqual(expect.objectContaining({
      enabled: true,
      visualizerEnabled: true,
      visualizerSensitivityPercent: 90,
      mode: "pulse",
    }));
  });

  it("keeps experimental Libre canvas opt-in", async () => {
    vi.spyOn(desktopApi, "settings").mockResolvedValue(settings());
    const save = vi.spyOn(desktopApi, "saveSettings").mockResolvedValue();
    renderSettings();

    const toggle = await screen.findByRole("checkbox", { name: /Libre-Song-Videos \(experimentell\)/ });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      experimentalLibreCanvas: true,
      songVideosEnabled: false,
    }));
  });

  it("saves song lyrics as an explicit local setting", async () => {
    vi.spyOn(desktopApi, "settings").mockResolvedValue(settings());
    const save = vi.spyOn(desktopApi, "saveSettings").mockResolvedValue();
    renderSettings();

    const toggle = await screen.findByRole("checkbox", { name: /Songtexte laden/ });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      lyricsEnabled: false,
    }));
  });

  it("finds settings of every kind by their label", async () => {
    vi.spyOn(desktopApi, "settings").mockResolvedValue(settings());
    renderSettings();

    const search = await screen.findByPlaceholderText("Einstellungen durchsuchen");
    fireEvent.change(search, { target: { value: "cache" } });
    const hits = await screen.findByRole("list", { name: "Einstellungen durchsuchen" });
    expect(within(hits).getByRole("button", { name: /Alle Caches löschen/ })).toBeVisible();
    fireEvent.change(search, { target: { value: "gibt es nicht" } });
    expect(await screen.findByText("Nichts gefunden")).toBeVisible();
  });

  it("points volume settings at the working audio-control page", async () => {
    vi.spyOn(desktopApi, "settings").mockResolvedValue(settings());
    renderSettings();

    expect(await screen.findByRole("link", { name: /^Audio-Modul/ })).toHaveAttribute(
      "href",
      "#/modules/audio-control",
    );
  });

  it("saves the optional current-track list navigation", async () => {
    vi.spyOn(desktopApi, "settings").mockResolvedValue(settings());
    const save = vi.spyOn(desktopApi, "saveSettings").mockResolvedValue();
    renderSettings();

    const toggle = await screen.findByRole("checkbox", { name: /Aktuellen Titel hervorheben/ });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      nowPlayingListNavigationEnabled: false,
    }));
  });

  it("saves a librespot windows output device", async () => {
    vi.spyOn(desktopApi, "settings").mockResolvedValue(settings());
    const save = vi.spyOn(desktopApi, "saveSettings").mockResolvedValue();
    renderSettings();

    fireEvent.click(await screen.findByRole("combobox", { name: /Windows-Audioausgabe/ }));
    fireEvent.click(await screen.findByRole("option", { name: "Voicemeeter Input" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      librespotAudioDevice: "Voicemeeter Input",
    }));
  });

  it("shows the Libre session with a sign-in action", async () => {
    vi.spyOn(desktopApi, "settings").mockResolvedValue(settings());
    const login = vi.spyOn(desktopApi, "startLibrespotLogin").mockResolvedValue({
      phase: "authenticating", credentialsPresent: false, username: null, message: null,
    });
    renderSettings();

    expect(await screen.findByText(/Librespot-Sitzung · Anmeldung nötig/)).toBeVisible();
    const signIn = screen.getByRole("button", { name: "Bei Spotify anmelden" });
    expect(signIn).toBeEnabled();
    expect(screen.getByRole("button", { name: "Abmelden" })).toBeDisabled();
    fireEvent.click(signIn);
    await waitFor(() => expect(login).toHaveBeenCalledOnce());
  });

  it("does not expose defaults for saving before persisted settings are hydrated", async () => {
    const pending = deferred<Settings>();
    const persisted = {
      ...settings(),
      searchHistoryEnabled: false,
      reconnectResumeMode: "never" as const,
    };
    vi.spyOn(desktopApi, "settings").mockReturnValue(pending.promise);
    const save = vi.spyOn(desktopApi, "saveSettings").mockResolvedValue();
    renderSettings();

    expect(screen.queryByRole("checkbox", { name: /Songtexte laden/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Einstellungen werden geladen/)).toBeVisible();

    pending.resolve(persisted);
    fireEvent.click(await screen.findByRole("checkbox", { name: /Songtexte laden/ }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      lyricsEnabled: false,
      searchHistoryEnabled: false,
      reconnectResumeMode: "never",
    }));
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
