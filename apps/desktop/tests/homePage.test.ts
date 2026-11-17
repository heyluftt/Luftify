import type { EntitySummary } from "@luft/protocol-types";
import { describe, expect, it } from "vitest";
import {
  homeFeatureLabel,
  isWeeklyMix,
  orderPlaylistsByUsage,
  recentPlaylistDescription,
  resolveHomeFeatureSource,
  selectHomeFeature,
  selectPersonalizedPlaylists,
} from "../src/features/home/homeFeature";
import {
  greetingForHour,
  homeConnectionLabel,
} from "../src/features/home/homeCopy";
import { buildHomeShelves } from "../src/features/home/homeShelves";
import type { PlaylistUsage } from "../src/types/tauri";

const playlist = (name: string, index: number): EntitySummary => ({
  uri: `spotify:playlist:${index}`,
  name,
});

describe("home page personalization", () => {
  it("prioritizes the localized weekly mix over other playlists", () => {
    const feature = selectHomeFeature([
      playlist("Road Trip", 1),
      playlist("Daily Mix 1", 2),
      playlist("Dein Mix der Woche", 3),
      playlist("Release Radar", 4),
    ], "personalized");
    expect(feature?.name).toBe("Dein Mix der Woche");
    expect(isWeeklyMix(feature!)).toBe(true);
  });

  it("recognizes the English weekly mix and keeps personalized ordering", () => {
    const personalized = selectPersonalizedPlaylists([
      playlist("Daily Mix 2", 1),
      playlist("Discover Weekly", 2),
      playlist("Release Radar", 3),
      playlist("Arbeitsfokus", 4),
    ]);
    expect(personalized.map((item) => item.name)).toEqual([
      "Discover Weekly",
      "Release Radar",
      "Daily Mix 2",
    ]);
  });

  it("falls back to the first real playlist without inventing content", () => {
    const feature = selectHomeFeature([playlist("Meine Favoriten", 1), playlist("Autofahrt", 2)]);
    expect(feature?.name).toBe("Meine Favoriten");
    const source = resolveHomeFeatureSource("lastPlayed", feature!, []);
    expect(source).toBe("library");
    expect(homeFeatureLabel(source, feature!)).toBe("Aus deiner Bibliothek");
  });

  it("prefers the last or most played local playlist according to the setting", () => {
    const playlists = [playlist("luft", 1), playlist("Are we alr?", 2), playlist("Release Radar", 3)];
    const usage: PlaylistUsage[] = [
      { playlistUri: playlists[0]!.uri, playCount: 14, lastPlayedAt: 100 },
      { playlistUri: playlists[1]!.uri, playCount: 4, lastPlayedAt: 200 },
    ];
    expect(selectHomeFeature(playlists, "lastPlayed", usage)?.name).toBe("Are we alr?");
    expect(selectHomeFeature(playlists, "mostPlayed", usage)?.name).toBe("luft");
    expect(selectHomeFeature(playlists, "fixed", usage, playlists[1]!.uri)?.name).toBe("Are we alr?");
    expect(orderPlaylistsByUsage(playlists, usage).map((item) => item.name)).toEqual([
      "Are we alr?",
      "luft",
      "Release Radar",
    ]);
  });

  it("does not mistake a user playlist named Car Mix for a Spotify personalized mix", () => {
    const personalized = selectPersonalizedPlaylists([
      playlist("Car Mix", 1),
      playlist("Daily Mix 1", 2),
      playlist("On Repeat", 3),
    ]);
    expect(personalized.map((item) => item.name)).toEqual(["Daily Mix 1", "On Repeat"]);
  });

  it("describes recent playlists with useful context", () => {
    const recent = playlist("Abendrunde", 1);
    expect(recentPlaylistDescription(recent, [{
      playlistUri: recent.uri,
      playCount: 4,
      lastPlayedAt: 6_400,
    }], 10_000)).toBe("Vor 1 Std. · 4 Wiedergaben");
  });

  it("uses calm time-aware greetings", () => {
    expect(greetingForHour(8)).toBe("Guten Morgen.");
    expect(greetingForHour(13)).toBe("Guten Tag.");
    expect(greetingForHour(20)).toBe("Guten Abend.");
    expect(homeConnectionLabel("loading-library")).toBe("Verbindung wird hergestellt");
    expect(homeConnectionLabel("offline-cache")).toBe("Offline-Inhalte");
    expect(homeConnectionLabel("needs-login")).toBe("Anmeldung nötig");
  });

  it("splits Spotify mixes, radar and weekly into separate shelves", () => {
    const shelves = buildHomeShelves([
      playlist("Daily Mix 1", 1),
      playlist("Daily Mix 2", 2),
      playlist("Release Radar", 3),
      playlist("Discover Weekly", 4),
      playlist("On Repeat", 5),
      playlist("Arbeitsfokus", 6),
    ]);
    expect(shelves.map((shelf) => shelf.id)).toEqual(["mixes", "radar", "weekly", "repeat"]);
    expect(shelves.find((shelf) => shelf.id === "mixes")?.items.map((item) => item.name))
      .toEqual(["Daily Mix 1", "Daily Mix 2"]);
  });

  it("does not put a user mix onto the Spotify mix shelf", () => {
    const shelves = buildHomeShelves([
      playlist("Car Mix", 1),
      playlist("Daily Mix 1", 2),
    ]);
    expect(shelves).toHaveLength(1);
    expect(shelves[0]?.items.map((item) => item.name)).toEqual(["Daily Mix 1"]);
  });
});
