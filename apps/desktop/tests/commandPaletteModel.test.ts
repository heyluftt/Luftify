import { describe, expect, it } from "vitest";
import type { PlaybackState } from "@luft/protocol-types";
import {
  buildCommandCatalog,
  groupPaletteItems,
  matchScore,
  moveSelection,
} from "../src/features/command-palette/commandPaletteModel";
import { paletteIntents } from "../src/features/command-palette/paletteIntents";
import { assemblePaletteItems } from "../src/features/command-palette/paletteItems";
import type { PaletteItem } from "../src/features/command-palette/paletteTypes";

const playback: PlaybackState = {
  currentItem: {
    uri: "spotify:track:1",
    source: "spotify",
    itemType: "track",
    title: "Airborne",
    creators: [{ name: "Atlas", uri: "spotify:artist:atlas" }],
    albumName: "Glass Cities",
    albumUri: "spotify:album:glass",
    durationMs: 180_000,
    explicit: false,
    playable: true,
  },
  isPlaying: true,
  positionMs: 12_000,
  durationMs: 180_000,
  volume: 0.7,
  isMuted: false,
  shuffleEnabled: false,
  repeatMode: "off",
  isSaved: false,
  contextUri: "spotify:playlist:night",
  updatedAt: new Date().toISOString(),
};

const catalog = (pathname = "/") => buildCommandCatalog({ pathname, connected: true, playback, soundEnabled: true });

const song: PaletteItem = {
  id: "tracks:spotify:track:nightcall",
  group: "spotify",
  label: "Nightcall",
  keywords: [],
  icon: "track",
  action: { kind: "media", media: { kind: "entity", category: "albums", entry: { uri: "spotify:album:x", name: "Nightcall" } } },
};

function assemble(query: string, extra: Partial<Parameters<typeof assemblePaletteItems>[0]> = {}) {
  return assemblePaletteItems({
    query,
    catalog: catalog("/library"),
    recent: [],
    intents: [],
    suggested: [],
    library: [],
    spotify: [],
    boost: () => 0,
    ...extra,
  });
}

describe("command palette model", () => {
  it("lists playback, the current album and artist, but not the current page, when empty", () => {
    const items = assemble("");
    expect(items.some((item) => item.id === "play-toggle" && item.label === "Pausieren")).toBe(true);
    expect(items.some((item) => item.id === "open-album")).toBe(true);
    expect(items.some((item) => item.id === "open-artist" && item.label === "Zu Atlas")).toBe(true);
    expect(items.some((item) => item.id === "nav-library")).toBe(false);
    expect(items.some((item) => item.group === "appearance" || item.group === "sound")).toBe(false);
  });

  it("ranks label starts above keywords and understands initials", () => {
    expect(matchScore("näch", { label: "Nächster Titel", keywords: [] })).toBeGreaterThan(
      matchScore("skip", { label: "Nächster Titel", keywords: ["skip"] }),
    );
    expect(matchScore("nt", { label: "Nächster Titel", keywords: [] })).toBeGreaterThan(0);
    expect(matchScore("xyz", { label: "Nächster Titel", keywords: [] })).toBe(0);
    expect(matchScore("theme hell", { label: "Theme: Hell", keywords: [] })).toBeGreaterThanOrEqual(80);
  });

  it("puts a well-named command first, music before weak matches and search last", () => {
    const items = assemble("atelier", { spotify: [song] });
    expect(items[0]?.id).toBe("theme:atelier");
    expect(items.at(-1)?.action.kind).toBe("search");
    expect(items.some((item) => item.id === "theme:redline")).toBe(false);

    const music = assemble("night", { spotify: [song] });
    const songIndex = music.findIndex((item) => item.id === song.id);
    const weakCommand = music.findIndex((item) => item.group === "commands-late");
    expect(songIndex).toBeGreaterThanOrEqual(0);
    if (weakCommand >= 0) expect(songIndex).toBeLessThan(weakCommand);
  });

  it("limits the palette to commands after a leading >", () => {
    const items = assemble("> zufall", { spotify: [song] });
    expect(items.map((item) => item.id)).toContain("shuffle");
    expect(items.some((item) => item.id === song.id || item.action.kind === "search")).toBe(false);
  });

  it("turns typed values into volume and seek actions", () => {
    expect(paletteIntents("laut 40", playback, true)[0]?.action).toEqual({ kind: "volume", percent: 40 });
    expect(paletteIntents("75%", playback, true)[0]?.action).toEqual({ kind: "volume", percent: 75 });
    expect(paletteIntents("1:30", playback, true)[0]?.action).toEqual({ kind: "seek", ms: 90_000 });
    expect(paletteIntents("+30", playback, true)[0]?.action).toEqual({ kind: "seek", ms: 42_000 });
    expect(paletteIntents("-60", playback, true)[0]?.action).toEqual({ kind: "seek", ms: 0 });
    expect(paletteIntents("1:30", undefined, true)).toEqual([]);
    expect(paletteIntents("nightcall", playback, true)).toEqual([]);
  });

  it("groups in display order and wraps the selection", () => {
    expect(groupPaletteItems(assemble("")).map((entry) => entry.group)).toEqual(["playback", "navigate"]);
    expect(moveSelection(0, 10, "ArrowDown")).toBe(1);
    expect(moveSelection(9, 10, "ArrowDown")).toBe(0);
    expect(moveSelection(0, 10, "ArrowUp")).toBe(9);
    expect(moveSelection(3, 10, "PageDown")).toBe(9);
    expect(moveSelection(3, 10, "PageUp")).toBe(0);
  });
});
