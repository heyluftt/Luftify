import { describe, expect, it } from "vitest";
import type { PlaylistDetails } from "@luft/protocol-types";
import {
  playlistLoadKind,
  playlistLoadLabel,
} from "../src/features/entities/playlistLoadStatus";

const details = (tracks: number, extras: Partial<PlaylistDetails> = {}): PlaylistDetails => ({
  uri: "spotify:playlist:night",
  name: "Night",
  tracks: Array.from({ length: tracks }, (_, index) => ({
    uri: `spotify:track:${index}`,
    source: "spotify",
    itemType: "track",
    title: `Track ${index}`,
    creators: [],
    explicit: false,
    playable: true,
  })),
  offset: 0,
  limit: 100,
  total: tracks,
  hasMore: false,
  ...extras,
});

describe("playlist load status", () => {
  it("stays quiet when nothing is fetching", () => {
    expect(playlistLoadKind({ fetching: false, showingCached: false, details: details(12) })).toBe("idle");
    expect(playlistLoadLabel("idle")).toBeUndefined();
  });

  it("uses loading only before the first tracks exist", () => {
    expect(playlistLoadKind({ fetching: true, showingCached: false, details: undefined })).toBe("loading");
    expect(playlistLoadLabel("loading")).toBe("Wird geladen …");
  });

  it("fills remaining titles instead of looking unprepared", () => {
    expect(
      playlistLoadKind({
        fetching: true,
        showingCached: false,
        details: details(20, { total: 80, hasMore: true }),
      }),
    ).toBe("filling");
    expect(playlistLoadLabel("filling")).toBe("Titel werden ergänzt …");
  });

  it("treats a cached complete list as a background refresh", () => {
    expect(
      playlistLoadKind({
        fetching: true,
        showingCached: true,
        details: details(12),
      }),
    ).toBe("refreshing");
    expect(playlistLoadLabel("refreshing")).toBe("Wird aktualisiert …");
  });
});
